# Workplan 0015 — Native Windows installer (no Docker, no terminal)

## Status — 2026-07-30 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 PGlite feasibility spike | ✅ **Done — PASS, 15/15** | `scripts/spike-pglite-windows.mjs`, run against the REAL `packages/ledger/migrations/0001_baseline.sql` (2580 lines, unmodified). Results in "The spike" below. |
| T1 driver seam (`pg.Pool` → PGlite) | ⬜ Not started | |
| T2 packaging shell decision + build | ⬜ Not started | Blocked on the UI (see "What this actually depends on"). |
| T3 installer, upgrade, uninstall | ⬜ Not started | |
| T4 code signing | ⬜ Not started | Needs a purchasing decision, not a technical one. |

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
| Write throughput, per-transaction | ~1700 rows/s → **~28s of ledger writes for a 48k-message mailbox** |
| Indexed natural-key lookup (ledger fast path) | 3 ms |
| On-disk size | 11 MB per 5,500 item rows (~2 KB/row) |
| Cold start / warm start | ~3.2 s / ~0.7 s |
| Data survives a restart | yes |

**This means ADR-0023 survives untouched.** Same SQL, same migrations, same
Drizzle schema, same RLS policies — the *server* goes away, not Postgres. No
SQLite fork, no second dialect.

### Two findings an adopter must not miss

1. **`row_security` defaults to `off` in PGlite**, where a real server defaults to
   `on`. With it off, a query that *would* be filtered raises `query would be
   affected by row-level security policy` instead of silently returning every
   tenant's rows. That is a loud failure rather than a quiet cross-tenant leak —
   the right direction to be wrong in — but it **must be set explicitly** on every
   session, and a test must assert it, because the failure mode if someone later
   "fixes" the error by turning RLS off is catastrophic and silent.
2. **`pgcrypto` must be loaded as a contrib extension** (`@electric-sql/pglite/contrib/pgcrypto`),
   or `CREATE EXTENSION pgcrypto` fails with "extension is not available". Nothing
   in our schema actually calls a pgcrypto function — `gen_random_uuid()` has been
   core Postgres since 13 — so that line is a `pg_dump` artefact of the old
   migration chain. Load the contrib rather than editing the baseline: keeping the
   file byte-identical to what real Postgres gets is worth more than removing two
   lines, and the squash equivalence proof stays valid.

3. **PGlite cannot simply be added alongside `pg`.** Installing
   `@electric-sql/pglite` into the workspace makes pnpm resolve a **second copy of
   `drizzle-orm`** — drizzle declares pglite as an optional peer, so its store key
   changes — and the workspace then typechecks two incompatible `SQL<unknown>`
   types against each other and fails outright. Found while running this spike.
   The consequence for T1: the driver switch is a **whole-workspace change made at
   once**, not an incremental "support both" step, and the spike script therefore
   runs PGlite via `pnpm dlx` rather than as a dependency.

## What this actually depends on — read before scheduling T2

**The UI is a hard prerequisite, not a parallel track.** An MSI that installs an
appliance whose entire operating surface is `curl http://localhost:8081/deletions`
is useless to someone who will not open a terminal — which is the whole point of
this workplan.

Today the self-host UI is **one page** (`apps/selfhost/src/confirm-page.ts`, 135
lines): discovery counts, the §11.2 scope manifest, and a "Start migration"
button. Everything after starting — status, the three decision queues (failures,
deletions, moves), `verify`, `apply`, `finish` — is JSON over HTTP with no UI in
either edition. The managed React app does not cover them either
(`grep -ril "failures|deletions|moves|verify|apply" apps/web/src` → no matches),
and three of its nine pages are 14-line placeholders.

So the order is: **UI → installer**, and the UI-architecture decision (one React
app served by both editions, agreed 2026-07-30) comes before either.

## Remaining decisions

- **T1 driver seam.** `withTenant(pool, tenantId, fn)` takes a `pg.Pool` and calls
  `pool.connect()`; PGlite has no pool and is single-connection. Needs a narrow
  interface both can satisfy. Drizzle already ships `drizzle-orm/pglite`, and the
  schema is shared, so this is a connection-layer change and not a query rewrite.
  `runMigrations()` takes a `connectionString` and will need the same seam.
- **T2 packaging shell.** **Tauri** (ADR-0019's existing plan: Rust toolchain,
  WebView2 which ships with Windows 11, tray icon, start-on-login, emits a real
  MSI) versus **Node SEA + Inno Setup/WiX** (no Rust, far simpler, but the UX is
  "we opened your browser at localhost"). Given the owner wants a proper Windows
  application rather than a disguised server, Tauri fits better — but it is only
  worth committing to once the UI exists to put inside it.
- **T3 install/upgrade/uninstall.** Where the data directory lives
  (`%LOCALAPPDATA%`), what uninstall does with a ledger that may be mid-migration
  (it is a rebuildable cache per ADR-0020, but the answer must be deliberate), and
  how an in-place upgrade runs migrations before the app serves.
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
2. **Concurrency.** The sync path runs at `DEFAULT_CONCURRENCY` 8; PGlite
   serialises DB access. The measurement above says the ledger is not the
   bottleneck (network I/O dominates by orders of magnitude), but that should be
   re-measured against a real corpus rather than 5,000 synthetic inserts.
3. **Does anything else in the stack assume a server?** `pg_dump`-based backup
   guidance in the runbook, the `DATABASE_URL` shape in config, and the
   compose-based self-host path all assume a reachable server. The container path
   must keep working unchanged (hard rule 5).
