# Workplan 0015 — Native Windows installer (no Docker, no terminal)

## Status — 2026-07-30 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 PGlite feasibility spike | ✅ **Done — PASS, 15/15** | `scripts/spike-pglite-windows.mjs`, run against the REAL `packages/ledger/migrations/0001_baseline.sql` (2580 lines, unmodified). Results in "The spike" below. |
| T1 driver seam (`pg.Pool` → PGlite) | ✅ **Done — the appliance runs on PGlite** | `packages/ledger/src/driver.ts` — `LedgerDriver`/`LedgerConnection`, with `pgDriver(pool)` as the only implementation. `withTenant()` goes through it and takes a driver **or** a pool, so the 45 existing call sites were untouched. Single-connection behaviour is unit-tested against a fake driver with PGlite's constraint (5 tests, serialisation mutation-verified). **Adoption done ([0016](./0016-pglite-adoption.md)): the whole-workspace blocker was not real** — it was an artefact of an incremental `pnpm add`; a clean `--frozen-lockfile` install resolves one drizzle. `pgliteDriver()` + `SELFHOST_PERSISTENCE=pglite`: the appliance starts, migrates itself and serves the operating surface **with no `DATABASE_URL`, no container, no port and no `initdb`** (4 startup tests). **Postgres was the last native dependency, so nothing now blocks T2 on runtime grounds.** |
| T2 packaging shell decision + build | 🟡 **Decided — [ADR-0027](../adr/0027-windows-packaging-shell.md); build not started** | **Windows Service + Start-menu shortcut. No native shell.** The observation that decided it: Tauri cannot run our TypeScript, so it needs the Node backend as a sidecar — it is the same packaging work *plus* a Rust toolchain, not an alternative to it. Bundling measured, not assumed: esbuild produces a single **2.8 MB** ESM bundle in ~150 ms, no errors (3.6 MB before T3 established that PGlite must stay external). Remaining build work is the installer (T3). |
| T3 installer, upgrade, uninstall | 🟡 **Payload done; the MSI is not** | `scripts/package-appliance.mjs` (`pnpm package:appliance`) stages a **27.6 MB relocatable directory** an installer copies verbatim: one 2.8 MB bundle, `start.mjs`, the real migration SQL, the built UI, and PGlite unbundled. `scripts/package-appliance.unit.test.ts` starts it as a real child process **with the repository nowhere in its environment** — it migrates itself, serves the operating surface, stops on `SIGTERM`, and comes back on the same data directory without re-migrating. 10 tests, ~12 s, no Docker. Two mutation-verified. The MSI/WiX half, service registration and the shortcut are Windows-only and not done. **2026-08-06: the Windows-side work is now PREPARED rather than merely pending** — `docs/windows-appliance-runbook.md` plus `scripts/windows/`. Ordered by what is UNKNOWN, cheapest first, because the reason the MSI is unbuilt is not that it is hard: **nobody has ever run the appliance on Windows at all.** The payload's ten tests start it as a real child process with the repository nowhere in its environment — on Linux. That proves it is relocatable and proves nothing about Windows. Phase 1 is therefore just *does `node start.mjs` work*, with the likely Windows-specific failures named in advance (PGlite resolving `pglite.wasm`/`pglite.data` via `import.meta.url` from a relocated directory is the one that would most change the plan — if it cannot, the no-Postgres premise needs revisiting for this platform). **One defect was found by reading, without a Windows machine, and it is real:** `start.mjs` defaults `pgliteDataDir` and `configDir` to *inside the payload*, which is `C:\Program Files\` once installed and therefore not writable by a service account — the database would fail to create on first start, as a permissions error, on an end user's machine. The installer must set both to `%ProgramData%`; `run-appliance.ps1` does exactly that so the thing tested is the thing that ships, and Phase 2 proves the defect before proving the fix. **A second, smaller one:** the port is 8080 in `apps/selfhost/src/index.ts` and in the payload, 8081 in the compose deployments, and ADR-0027's shortcut was written against 8081 — a shortcut pointing at a port nothing is listening on is a day-one support ticket, so the service XML sets it explicitly and the choice is recorded as the owner's. Phase 3 recommends **WinSW** over nssm (unmaintained since 2017, interactive installer) and raw `sc.exe` (cannot supervise a plain `node.exe`), with a ready configuration; the part flagged as least certain is shutdown — `start.mjs` closes PGlite on SIGINT/SIGTERM but **Windows services receive no POSIX signals**, so how the wrapper terminates the child decides whether the database closes cleanly or is killed mid-write, and the runbook says to test that deliberately. **Nothing in `scripts/windows/` has been executed by anyone** — there is no Windows in CI and none in the agent environment — and every file says so at the top rather than reading as tested. `collect-evidence.ps1` exists so one paste is enough to act on, since each round trip on a Windows-only failure otherwise costs a day. **THE OPEN QUESTION IS CLOSED, 2026-08-06: the payload ships its own Node runtime.** The owner uninstalled Node from the target laptop and asked why it was needed at all — the right test of *"end users never touching bash, a Linux filesystem or Docker"*, and one two versions of the runbook had failed: the first asked for Node, pnpm AND Git, the second for Node. Both made an owner install a DEVELOPER toolchain to test a product whose premise is that none of it is needed. `pnpm package:appliance --with-node win-x64` now stages `node.exe` beside `start.mjs`, the WinSW definition executes `%BASE%\..\..\node.exe`, `run-appliance.ps1` prefers the bundled runtime and warns loudly when it falls back to a system one, and `collect-evidence.ps1` reports the SHIPPED runtime's version rather than whatever is on PATH. **The trade, stated:** 28.8 MB → 117.3 MB (`node.exe` win-x64 is 88.5 MB), and a runtime we now patch. `NODE_RUNTIME_VERSION` is pinned so a bump is a reviewed edit, and the download is verified against the release's own `SHASUMS256.txt` with a mismatch stopping the build — shipping somebody else's binary unverified is a supply-chain hole with a progress bar. Opt-in at the flag, so a Linux dev build still stages 28.8 MB and does not pay for a download it will never run. **Verified end to end from Linux:** the staged binary is a `PE32+ executable (console) x86-64` whose sha256 equals the published `3602f2bb…` for `v24.19.0/win-x64/node.exe`. It has NOT been executed — there is no Windows here. **5 unit tests**, deliberately not exercising the 93 MB download (CI should not pay for it per push) but pinning the half that fails quietly: checksum selection for the exact file, a null rather than a guess for a file the release does not list, a mismatch that throws naming both hashes and says *never a warning*, and that a default build ships no runtime at all. **PHASES 1 AND 2 RAN ON REAL WINDOWS ON 2026-08-06, AND BOTH PASSED.** The single biggest unknown in this plan is answered: **PGlite boots from a relocated directory on Windows.** All six migrations applied on a payload built on Linux and copied across, the UI served, and a second start reported `schema up to date` — so the database was written AND closed cleanly, which is the property the whole service design rests on. The prediction that this was the most likely Windows-specific failure was wrong, and being wrong here is the good outcome: ADR-0023's no-Postgres premise holds on Windows. **Phase 2 also passed, and the preflight written blind two hours earlier fired exactly as designed:** from `C:\Program Files\`, as a normal user, `EPERM … .openmig-write-probe` named the directory and `SELFHOST_PGLITE_DIR`, and with both variables pointed at `%ProgramData%` it started and migrated normally. **Three findings for the runbook, all from watching a real session rather than reasoning:** the runbook assumed PowerShell without saying so and the owner was in `cmd`, where `Copy-Item` does not exist; Phase 2 needs TWO shells (elevated to place files as an installer would, unprivileged to run as a service would) and said neither; and **Windows blocks unsigned `.ps1` under the stock `Restricted` policy** — *"running scripts is disabled on this system"* — which is a real constraint on the installer, not just the runbook, and a second concrete reason for T4 beyond SmartScreen. Answered with `.cmd` wrappers beside each script — they pass `-ExecutionPolicy Bypass` for that ONE process rather than telling an owner to run `Set-ExecutionPolicy RemoteSigned`, which would weaken their machine permanently in order to read a diagnostic file. **AND THE UI SHIPPED UNSTYLED, IN BOTH EDITIONS, WHICH IS NOT A WINDOWS BUG AT ALL.** Opening the appliance in a browser — the first time anyone had — showed raw unstyled HTML. `apps/web/src/index.css` carried Tailwind **v3**'s `@tailwind base/components/utilities` triple while Tailwind **v4** was installed, with no `postcss.config.*` anywhere in the repo and no `@tailwindcss/vite` in the Vite config. Nothing processed it: Vite copied the file through verbatim, the browser ignored the at-rules, and 3 KB of `:root` custom properties was the entire stylesheet. **Nothing caught it because nothing looked** — the packaging test asserts `/ui/confirm` returns `<!doctype html>` and the e2e UI smoke asserts the screens boot, and both are true of a completely unstyled page. Fixed by wiring `@tailwindcss/vite` and moving to the v4 entry; the stylesheet goes from 3.08 KB to 35.63 KB of real utilities. **CONFIRMED VISUALLY by the owner on Windows, 2026-08-06** — the appliance *"now looks like an actual application/website"*. Worth recording as a separate fact from the build numbers: everything checkable from here was mechanical (the stylesheet is 35.63 KB, contains no unprocessed directives, and defines the classes the components use), and none of that is the same as a person looking at the page. The bug existed precisely because every check in this repository was of the mechanical kind. **A second, older defect surfaced underneath it:** `tailwind.config.js` defined `primary`/`success`/`warning` as numeric 50–900 scales, and a search of every `.tsx` and `.css` finds **zero** uses of them — every class in the app is a shadcn-style token (`border-border`, `bg-background`) that the config never defined. So the config was not merely unprocessed, it described a palette nobody wrote against. The tokens are defined in CSS now via `@theme inline`, so `.dark` swapping the variables still works. **4 regression tests** pin the wiring rather than the output, since the packaging suite stages a stub UI on purpose: the v4 entry, the plugin in `plugins[]`, the dependency declared, and the tokens mapped. The first version of that test failed on its own comment quoting the removed directive, so the regex is anchored to a real one. **Both `.cmd` wrappers confirmed working on Windows 11 Home, 2026-08-07**, from `cmd` — `collect-evidence.cmd` wrote its 143-line report and `run-appliance.cmd` started the appliance against `%ProgramData%` with `node : v24.19.0 (C:\Program Files\OpenMigrateTest\node.exe)`, i.e. the BUNDLED runtime, resolved from the install directory. The report also confirms the pieces that were predicted to be the risk: `LongPathsEnabled: 1`, and PGlite's three assets found and sized (`initdb.wasm` 0.4 MB, `pglite.data` 6 MB, `pglite.wasm` 9.6 MB). **One claim is NOT yet proven, and the evidence says so: `node --version` on that laptop answers v24.19.0**, so a system Node is on PATH. Every run used the bundled binary — the printed path proves it — but *"runs on a machine with nothing installed"* has not actually been tested on a machine with nothing installed. That wants a clean VM before it is claimed anywhere user-facing. **A smaller one:** a recursive copy of an already-run payload carries its `data\` directory along, which is how 117.3 MB of build became 157.2 MB in Program Files. Harmless for a real installer (it copies a fresh build) and a good illustration of why the writable state must not live inside the payload; the runbook now says `-Exclude data`. **THE CRASH TEST PASSED, 2026-08-07, AND IT CHANGES THE MECHANISM DECISION.** `Stop-Process -Force` — the hardest kill Windows offers, no clean shutdown at all — and the appliance came back with `schema up to date`. **PGlite is Postgres, and Postgres survives being killed for a living**: WAL recovery is its normal operating mode, not an edge case. That matters because the ONLY thing a service wrapper was going to buy is translating `SERVICE_CONTROL_STOP` into something `start.mjs` can act on, Windows services receiving no POSIX signals. If an abrupt stop is safe, that requirement mostly evaporates — **and so does the reason to vendor a third-party binary.** **WinSW was the wrong recommendation and the owner caught it.** Checked: `v3.0.0-alpha.11` (2025-01-29) is an ALPHA — the v3 line has been in alpha since 2021 — and the newest stable, `v2.12.0`, is from 2025-01-28 with nothing since. Shipping either in a customer-facing MSI means vendoring a dormant binary we would then sign and patch. **The open option is now Windows Task Scheduler**, "At startup", as a service account: built in, nothing vendored, nothing extra to sign, and it satisfies what ADR-0027 actually requires — *"starts on boot and keeps syncing whether or not anyone is logged in"* — even though it is not literally a Service in the Services panel. **That is an OWNER DECISION, because it departs from the ADR's words**, and it is not taken here. **A build stamp was added the same day, from a real confusion.** Two payload copies on one machine are indistinguishable by eye — an installed one under `C:\Program Files\` and a test one in a download folder — and nothing in the startup log said which build was running (`loaded 0 mapping(s)` is about DATA, not code). That cost half an hour re-testing the CSS fix against a payload copied before the fix existed. `start.mjs` now prints `[appliance] build <version> (<commit>)` as its FIRST line, before anything can fail, and `collect-evidence.ps1` reports it. Version and commit, deliberately **no timestamp**: the same commit must stage the same bytes. 2 tests, one pinning the substitution and one pinning that it is line ONE — a stamp printed after the database opens is absent from exactly the logs where it is most needed. **T4 code signing stays deferred and correctly so:** there is still nothing to sign — though note the payload now contains a Microsoft-signed `node.exe`, which is not the same as the appliance being signed. |
| T4 code signing | 🟢 **Decided 2026-08-03 — DEFERRED** | Owner decision (0025 T6, same call): no certificate until the appliance has been run and tested on the owner's own Windows machine. Correct ordering, and there is nothing to sign yet regardless — T3's MSI is unbuilt. Revisit before `v0.1.0` proper. |
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

- ~~The managed edition implementing the contract.~~ **Done since this was
  written** (2026-08-01 review correction): the managed API serves deletions,
  moves, failures, finish, the verify pair and apply — workplans 0017/0018.
  Nothing managed-side blocks T2 any more.
- **Whether PGlite becomes the appliance DEFAULT.** 0016 closed with "making
  it the default belongs to 0015" and this file never recorded that handoff
  (found by the 2026-08-01 review). It is the shipped-installer posture
  question: the MSI shape (ADR-0027) has no Postgres container, so the
  installer path effectively decides it. Decide alongside T2; record here and
  in ADR-0028.

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

1. **Does the managed edition stay on server Postgres? — ANSWERED** (closed by
   0016 P4 and recorded in [ADR-0028](../adr/0028-pglite-appliance-persistence.md)):
   yes. The two-backend cost this question feared is paid and gated — RLS is
   enforced through the `LedgerDriver.role` seam on both appliance backends,
   and the e2e gate runs the full suite per backend.
2. **Concurrency — ANSWERED.** See [0016 P5](./0016-pglite-adoption.md#p5--concurrency-measured).
   Serialisation costs nothing measurable at `DEFAULT_CONCURRENCY` 8: the real
   ledger hot path is flat at 3.6–3.9 ms/item across widths 1→16, and width 8
   against width 1 came out at +6.8%, −0.0% and −6.2% over three runs — noise.

   That measurement also corrects two claims above: the ~1700 rows/s figure was
   synthetic single-statement inserts and the real path runs at ~270 items/s;
   and "not the bottleneck by orders of magnitude" is really ~13× — one order of
   magnitude, with the ledger at ~7% of wall clock. Comfortably fine, not free.

   Still measured against synthetic items rather than a real mailbox.