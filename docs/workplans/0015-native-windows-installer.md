# Workplan 0015 — Native Windows installer (no Docker, no terminal)

## Status — 2026-07-30 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 PGlite feasibility spike | ✅ **Done — PASS, 15/15** | `scripts/spike-pglite-windows.mjs`, run against the REAL `packages/ledger/migrations/0001_baseline.sql` (2580 lines, unmodified). Results in "The spike" below. |
| T1 driver seam (`pg.Pool` → PGlite) | ✅ **Done — the appliance runs on PGlite** | `packages/ledger/src/driver.ts` — `LedgerDriver`/`LedgerConnection`, with `pgDriver(pool)` as the only implementation. `withTenant()` goes through it and takes a driver **or** a pool, so the 45 existing call sites were untouched. Single-connection behaviour is unit-tested against a fake driver with PGlite's constraint (5 tests, serialisation mutation-verified). **Adoption done ([0016](./0016-pglite-adoption.md)): the whole-workspace blocker was not real** — it was an artefact of an incremental `pnpm add`; a clean `--frozen-lockfile` install resolves one drizzle. `pgliteDriver()` + `SELFHOST_PERSISTENCE=pglite`: the appliance starts, migrates itself and serves the operating surface **with no `DATABASE_URL`, no container, no port and no `initdb`** (4 startup tests). **Postgres was the last native dependency, so nothing now blocks T2 on runtime grounds.** |
| T2 packaging shell decision + build | 🟡 **Decided — [ADR-0027](../adr/0027-windows-packaging-shell.md); build not started** | **Windows Service + Start-menu shortcut. No native shell.** The observation that decided it: Tauri cannot run our TypeScript, so it needs the Node backend as a sidecar — it is the same packaging work *plus* a Rust toolchain, not an alternative to it. Bundling measured, not assumed: esbuild produces a single **2.8 MB** ESM bundle in ~150 ms, no errors (3.6 MB before T3 established that PGlite must stay external). Remaining build work is the installer (T3). |
| T3 installer, upgrade, uninstall | 🟡 **Payload done; the MSI is not** | `scripts/package-appliance.mjs` (`pnpm package:appliance`) stages a **27.6 MB relocatable directory** an installer copies verbatim: one 2.8 MB bundle, `start.mjs`, the real migration SQL, the built UI, and PGlite unbundled. `scripts/package-appliance.unit.test.ts` starts it as a real child process **with the repository nowhere in its environment** — it migrates itself, serves the operating surface, stops on `SIGTERM`, and comes back on the same data directory without re-migrating. 10 tests, ~12 s, no Docker. Two mutation-verified. The MSI/WiX half, service registration and the shortcut are Windows-only and not done. |
| T4 code signing | ⬜ Not started | Needs a purchasing decision, not a technical one. |
| **UI prerequisite** — operating contract + operating screens | ✅ **Done** | [ADR-0026](../adr/0026-one-operating-ui-one-contract.md). Contract in `packages/shared/src/operating-contract.ts`, served by `apps/selfhost`; deletions/moves/failures screens in `apps/web` (9 tests, apply-gate mutation-verified); **served from the appliance at `/ui`** (17 tests, traversal-probed over a raw socket against the real bundle). **Verify and finish screens done** — finish is the runbook's five-step cutover checklist, gated on the operator confirming delivery has moved (mutation-verified). **Managed edition implements it** — the three queues, keep/retry/accept and finish, from the same shapes and prose (`apps/api/.../operating-routes.ts`; 4 route tests, Express-5 registration mutation-verified). `apply`/`verify` stay worker-side by design — see the ADR's update notes. **Confirm page folded in**: the appliance's hand-rolled HTML is deleted and `GET /` redirects to `/ui/confirm`, so it runs one UI technology instead of two (17 tests). |

> Read [ADR-0019](../adr/0019-packaging-runtime-targets.md) (packaging; and its
> 2026-07-30 update note) and [ADR-0023](../adr/0023-persistence-postgres-only.md)
> (Postgres-only) first.

## The goal, stated as the owner did

A single `.msi`/`.exe` that installs everything needed. **End users must never
touch bash, a Linux filesystem, or Docker.** Today the supported Windows path is
Docker Desktop + WSL2, which fails that test completely.

## Why this became tractable

Deleting the four shell-out engines (imapsync/vdirsyncer/rclone wrappers, PR #172)
left the runtime **pure JavaScript** — no Perl, no Python, no external binaries.
That reduced the native-Windows problem to exactly one thing: **Postgres**, which
ADR-0023 makes mandatory for both editions.

Shipping a Postgres *server* in an MSI is the heavy option: ~300 MB, a Windows
service, `initdb` on first run, a port to collide with, and a major-version
upgrade problem on every user's laptop — all for a single-user desktop app.

## The spike (T0) — PGlite works, with one caveat

PGlite is real Postgres compiled to WASM, running **in-process**: no service, no
port, no `initdb`. Run `node scripts/spike-pglite-windows.mjs` to reproduce.

**15/15 checks passed against the real baseline migration**, PostgreSQL 18.3
(PGlite 0.5.4):

| What | Result |
|---|---|
| The real `0001_baseline.sql`, unmodified | applies |
| Schema | 26 tables |
| RLS | 96 policies on 24 tables |
| `app_user` cluster-global role | created |
| `gen_random_uuid()`, `pg_advisory_lock` | work |
| Transaction-local `set_config` (what `withTenant()` needs) | works, resets on rollback |
| **RLS actually ENFORCES** as `app_user` | tenant A sees 1 of 2 rows, B sees 1 of 2 |
| **Cross-tenant INSERT** | refused by policy |
| Write throughput, per-transaction | ~1700 rows/s → ~28s for a 48k-message mailbox — ⚠️ **synthetic; see [0016 P5](./0016-pglite-adoption.md#p5--concurrency-measured)**, which measures the real hot path at ~270 items/s (~170–185 s for the same mailbox) |
| Indexed natural-key lookup (ledger fast path) | 3 ms |
| On-disk size | 11 MB per 5,500 item rows (~2 KB/row) |
| Cold start / warm start | ~3.2 s / ~0.7 s |
| Data survives a restart | yes |

**This means ADR-0023 survives untouched.** Same SQL, same migrations, same
Drizzle schema, same RLS policies — the *server* goes away, not Postgres. No
SQLite fork, no second dialect.

### Three findings — two of them since corrected

1. ⚠️ **CORRECTED — the symptom was real, the cause was not.** This recorded that
   PGlite defaults `row_security` to `off` where a real server defaults it `on`.
   Measured directly against PGlite 0.5.4, a fresh instance reports **`on`**.
   What turns it off is **our own migration**: `0001_baseline.sql` is a `pg_dump`
   and line 43 of its preamble is `SET row_security = off;`.

   Harmless on a pool — session-scoped, dies with the client that migrated. On a
   single persistent connection it would disable row security for the life of
   the process, so `pgliteDriver()` re-asserts it per acquire. **Not a PGlite
   quirk**: any driver reusing one long-lived connection across
   migrate-then-serve inherits it. See [0016 P2](./0016-pglite-adoption.md).

   The conclusion "set it explicitly and assert it in a test" stands; the reason
   is different, and the difference matters because it applies to `pg` too.
2. **`pgcrypto` must be loaded as a contrib extension** (`@electric-sql/pglite/contrib/pgcrypto`),
   or `CREATE EXTENSION pgcrypto` fails with "extension is not available". Nothing
   in our schema actually calls a pgcrypto function — `gen_random_uuid()` has been
   core Postgres since 13 — so that line is a `pg_dump` artefact of the old
   migration chain. Load the contrib rather than editing the baseline: keeping the
   file byte-identical to what real Postgres gets is worth more than removing two
   lines, and the squash equivalence proof stays valid.

3. ⚠️ **WITHDRAWN — this was not true, and it parked the work for nothing.**
   This recorded that installing `@electric-sql/pglite` makes pnpm resolve a
   second `drizzle-orm` and breaks the workspace typecheck, so adoption had to be
   one atomic whole-workspace change.

   The symptom reproduces exactly. The cause is that **`pnpm add` relinks
   incrementally** — it left `apps/worker` on the old instance while the root and
   `packages/ledger` moved — and the lockfile was already consistent. A plain
   `pnpm install` converges every importer, and a clean `--frozen-lockfile`
   install, which is what CI and any new checkout does, resolves exactly **one**.

   No overrides, no `.npmrc` change, no atomic commit: it is an ordinary
   dependency of `packages/ledger`. See [0016 P0/P1](./0016-pglite-adoption.md).
   **Re-run `pnpm install` before concluding a dependency is incompatible.**

## What this actually depends on — read before scheduling T2

**The UI is a hard prerequisite, not a parallel track.** An MSI that installs an
appliance whose entire operating surface is `curl http://localhost:8081/deletions`
is useless to someone who will not open a terminal — which is the whole point of
this workplan.

When this was written, the self-host UI was **one page**
(`apps/selfhost/src/confirm-page.ts`, 135 lines): discovery counts, the §11.2
scope manifest, and a "Start migration" button. Everything after starting —
status, the three decision queues (failures, deletions, moves), `verify`,
`apply`, `finish` — was JSON over HTTP with no UI in either edition.

So the order is: **UI → installer**, and the UI-architecture decision comes
before either.

### Status of that prerequisite (2026-07-30, later the same day)

The decision is recorded as **[ADR-0026](../adr/0026-one-operating-ui-one-contract.md)**:
one React app, served by both editions, against a contract *extracted* from the
endpoints self-host already serves rather than designed fresh.

Done:

- The operating contract in `packages/shared/src/operating-contract.ts` — queue
  shapes, `/status`, decision outcomes, and the operator-facing prose, which is
  part of the contract rather than the UI's to paraphrase.
- `apps/selfhost` serves all three queues through it (the shapes were
  `Record<string, unknown>`; response bodies are unchanged, so the e2e gates
  keep their meaning).
- Deletions, moves and failures screens in `apps/web`, with keep/apply/retry/
  accept. The `apply` gate is imported from shared, not re-derived, and its
  test is verified against a mutated source.
- **The appliance serves the bundle at `/ui`** (`apps/selfhost/src/static-ui.ts`),
  built by `pnpm --filter @openmig/web build:selfhost` and carried in the image.
  The prefix is load-bearing: this server already answers `/deletions`,
  `/moves` and `/failures` with JSON, which are also screen names, so a
  root-mounted SPA would have to arbitrate by `Accept` header. The confirm page
  links through once a mapping has started.

**That means "no terminal" is now true for the decision queues**, which was T2's
actual blocker.

- **The §20 check and the end of the migration.** `verify` is behind an explicit
  button, never run on mount and never polled: it counts and samples the TARGET,
  so it is real network work rather than a status read. `finish` is **the
  runbook's five-step cutover sequence as a screen**, not a button — because
  while a mapping is active, items still arriving on the old system are being
  copied across, and finishing stops that. Finish before mail delivery has
  moved and everything arriving afterwards is never copied, with nothing
  reporting it. Steps 1–3 the appliance checks for itself; step 4 (MX/DNS) is
  outside the tool, so it is the one thing the operator is asked to attest to,
  and the finish button stays disabled until they do.

Not done, and still between here and T2:

- **The managed edition implementing the contract.** It still has no deletions,
  moves, failures, verify or finish endpoints. Not on the installer's critical
  path — the appliance is what gets installed — but leaving it undone is what
  makes "one app, both editions" a claim rather than a fact.

### A note for whoever picks up T2

The UI is React served over HTTP, which means the Tauri-versus-Node-SEA question
in "Remaining decisions" is now a question about the SHELL only: both options
render the same bundle, and neither needs the UI rebuilt. Tauri's WebView2 would
point at the local server exactly as a browser does. That makes the decision
cheaper than it looked when this workplan was written, and reversible.

## Remaining decisions

- **T1 driver seam — the interface exists; the PGlite side does not.**
  `withTenant()` now takes a `LedgerDriver` (`packages/ledger/src/driver.ts`)
  and `pgDriver(pool)` implements it. `runMigrations()` goes through it as well
  and accepts a driver INSTEAD of a connection string — which matters more than
  it looks: **PGlite is a file, not a server**, so there is no connection string
  to give it, and a `connectionString`-only signature would have kept the
  appliance tied to a running Postgres long after every query became portable.
  What remains is the PGlite driver itself, which is **parked as its own
  workplan — [0016](./0016-pglite-adoption.md)** — because it is *blocked*
  rather than merely unscheduled, and that is easy to lose track of. Neither T0
  nor T1 delivers anything to a user on its own: the appliance still requires a
  Postgres server until 0016 lands.

  **The single-connection point is a correctness requirement, not a performance
  one, and it is the thing to get right.** `pg.Pool` hands out N independent
  connections; PGlite has exactly one. Two concurrent `withTenant` calls on one
  connection would produce `BEGIN` inside `BEGIN`, one `COMMIT` ending both, and
  `app.current_tenant` set by one tenant while the other is mid-query — that is
  cross-tenant exposure caused by concurrency alone, with every RLS policy still
  correctly written and every integration test still green. So a PGlite driver
  MUST serialise `acquire()`, and the seam is shaped to let it: `acquire()` may
  wait, and `withTenant` is ignorant of which kind it holds. That property is
  already unit-tested against a fake single-connection driver, and the test was
  verified to fail when the serialisation is removed.
- **T2 packaging shell — DECIDED.** See
  [ADR-0027](../adr/0027-windows-packaging-shell.md): a Windows Service plus a
  Start-menu shortcut to `http://localhost:8081/ui`, with no native shell.

  The reasoning that settled it, since this was previously framed as
  "Tauri versus Node SEA": **that is a false pair.** Tauri is a Rust shell and
  cannot run our TypeScript, so it needs the Node backend as a *sidecar* — which
  means packaging the backend first, which is the whole job. Tauri is that work
  plus a second toolchain. And the requirement is that end users never touch
  bash, a Linux filesystem or Docker; it says nothing about a native window, and
  a Start-menu shortcut satisfies it completely.

  The payload is the same either way: a **2.8 MB** backend bundle, **~24 MB** of
  PGlite WASM and data, the 500 KB web bundle, and 88 KB of migrations SQL that
  must sit beside the binary — **27.6 MB** staged, measured by T3 rather than
  estimated. (This originally read 3.6 MB, from a bundle that still contained
  PGlite's JavaScript; T3 had to leave the package external, which takes it
  out. See ADR-0027's update note.) The Node runtime (~110 MB) is the largest
  line and the obvious target if size ever becomes a complaint — the shell is
  not.

  Node SEA was rejected specifically: it is experimental, needs a CommonJS entry
  (three `import.meta.url` sites work against that), and the WASM ships alongside
  regardless — so it takes an unstable API's constraints without delivering the
  single-file result that is the only reason to want it.

- **T3 install/upgrade/uninstall — the payload half is built.** `pnpm
  package:appliance` stages the directory an installer copies. What bundling
  broke, and what each fix is doing, is written up in the script's header; the
  short version is that all three failures were about *how a module finds a
  file*, which is exactly what a file listing cannot check — hence a test that
  boots the payload as a real process with the repository out of its
  environment.

  **Still open, and all Windows-side:** where the data directory lives
  (`%LOCALAPPDATA%`), what uninstall does with a ledger that may be mid-migration
  (it is a rebuildable cache per ADR-0020, but the answer must be deliberate),
  how an in-place upgrade runs migrations before the app serves, and whether the
  payload ships its own Node runtime or requires one. That last one matters: the
  payload needs Node 22+ and nothing else, and "install Node first" is precisely
  the kind of instruction ADR-0027 exists to avoid.
- **T4 code signing.** An unsigned MSI/EXE gets a SmartScreen block on every
  download. EV certificate or Azure Trusted Signing — a recurring cost and a CI
  change, not an afterthought. Decide before T3, because it shapes the release
  pipeline.

## Open questions

1. **Does the managed edition stay on server Postgres?** Almost certainly yes —
   PGlite is single-connection and single-process, which is wrong for a
   multi-tenant API with a worker fleet. That means **two persistence backends**,
   which is a real cost: the RLS integration tests must run against both, or the
   self-host edition's isolation is asserted against a database nobody ships.
2. **Concurrency — ANSWERED.** See [0016 P5](./0016-pglite-adoption.md#p5--concurrency-measured).
   Serialisation costs nothing measurable at `DEFAULT_CONCURRENCY` 8: the real
   ledger hot path is flat at 3.6–3.9 ms/item across widths 1→16, and width 8
   against width 1 came out at +6.8%, −0.0% and −6.2% over three runs — noise.

   That measurement also corrects two claims above: the ~1700 rows/s figure was
   synthetic single-statement inserts and the real path runs at ~270 items/s;
   and "not the bottleneck by orders of magnitude" is really ~13× — one order of
   magnitude, with the ledger at ~7% of wall clock. Comfortably fine, not free.

   Still measured against synthetic items rather than a real mailbox.